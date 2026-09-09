import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import {
  inventarioDelAmbiente,
  inventarioDeSecretos,
  SECRETOS_DE_ARRANQUE,
} from "../componentes/secretos";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { namespaceDelSistema } from "../descriptor/entorno";
import { contenedoresDe, podsDe } from "../componentes/tipos";
import { ENVIRONMENTS, type Environment } from "../config";
import { manifiestosDeLosSistemas } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * El inventario de INF-06 (issue #154), sin tocar ningun cluster ni generar ninguna
 * clave: aqui solo se prueban los METADATOS —que no haya una entrada duplicada, que
 * ningun secreto de la aplicacion se cuele en la lista de arranque de Pulumi—.
 */

describe("inventarioDeSecretos", () => {
  it.each(ENVIRONMENTS)("%s: ninguna entrada de (secreto, clave) se repite", (ambiente) => {
    const entradas = inventarioDeSecretos(ambiente);
    const pares = entradas.map((e) => `${e.secreto}/${e.clave}`);
    expect(new Set(pares).size).toBe(pares.length);
  });

  it.each(ENVIRONMENTS)("%s: cada rol tiene un identificador unico", (ambiente) => {
    const roles = inventarioDeSecretos(ambiente).map((e) => e.rol);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("los dos ambientes nombran Secret distintos (sin compartir namespace)", () => {
    const [stg, prod] = ENVIRONMENTS.map((a) => new Set(inventarioDeSecretos(a).map((e) => e.secreto)));
    for (const nombre of stg!) {
      expect(prod!.has(nombre), `«${nombre}» aparece en los dos ambientes`).toBe(false);
    }
  });

  it("ningun secreto de la aplicacion aparece tambien en la lista de arranque de Pulumi", () => {
    // La demostracion de ADR-0011 §3 hecha estructural: si alguien reintrodujera
    // `keycloakAdminPassword` en SECRETOS_DE_ARRANQUE —el error que este issue corrige—,
    // esta prueba lo detecta sin que nadie tenga que acordarse de mirar.
    const deArranque = new Set(SECRETOS_DE_ARRANQUE.map((s) => s.clave));
    const deLaAplicacion = new Set(inventarioDeSecretos("prod").map((e) => e.rol));
    for (const clave of deArranque) {
      expect(deLaAplicacion.has(clave), `«${clave}» esta en las dos listas`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C-17 §4 — el inventario cubre los CINCO espacios de nombres, no uno
// ─────────────────────────────────────────────────────────────────────────────

/** Todo `secretKeyRef` que los manifiestos de un sistema montan de verdad. */
function secretosQueMonta(sistema: string, ambiente: Environment): Set<string> {
  const plataforma = construirManifiestos(invariantesDe(ambiente));
  const suyos = manifiestosDeLosSistemas(invariantesDe(ambiente), plataforma).filter(
    (m) => m.metadata.namespace === `kamayuk-${sistema}-${ambiente}`,
  );
  const referencias = new Set<string>();
  for (const m of suyos) {
    for (const { pod } of podsDe(m)) {
      for (const c of contenedoresDe(pod)) {
        for (const v of c.env ?? []) {
          const ref = v.valueFrom?.secretKeyRef;
          if (ref !== undefined) referencias.add(`${ref.name}/${ref.key}`);
        }
      }
    }
  }
  return referencias;
}

describe("C-17 §4 · lo que se declara es lo que se monta", () => {
  /**
   * **El defecto que este criterio existe para cazar, y era total.**
   *
   * `yarn secretos --ambiente stg` declaraba nueve `Secret` —los nueve del monolito— y los
   * manifiestos de los cuatro sistemas montaban diez. La interseccion era **cero**:
   * `bootstrap-secretos.sh` corria, decia «Listo» y creaba cero de los diez.
   *
   * Y el desajuste tenia dos mitades. Una: el inventario no componia los descriptores. La otra:
   * `claves()` nombraba `kamayuk-<sistema>-app` —sin el ambiente— mientras el `secretKeyRef`
   * pedia `kamayuk-<sistema>-<ambiente>-app`, asi que aun componiendolos no habrian coincidido.
   *
   * El sintoma de un `secretKeyRef` que no existe no es un error: el pod se queda en `Pending`
   * con el `Secret` ausente en su evento, y el despliegue no dice nada.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» declara exactamente lo que monta", (sistema) => {
    const declarado = new Set(
      inventarioDelAmbiente(invariantesDe("stg"))
        .filter((e) => e.namespace === `kamayuk-${sistema}-stg`)
        .map((e) => `${e.secreto}/${e.clave}`),
    );
    const montado = secretosQueMonta(sistema, "stg");

    expect(montado.size, `«${sistema}» no monta ningun Secret: ¿se dejo de mirar?`).toBeGreaterThan(0);

    const sinDeclarar = [...montado].filter((r) => !declarado.has(r));
    expect(
      sinDeclarar,
      "estos `secretKeyRef` no los genera nadie: el pod se queda en `Pending` con el `Secret` " +
        "ausente en su evento, que no es un error del despliegue sino una espera indefinida.",
    ).toEqual([]);

    const sinMontar = [...declarado].filter((r) => !montado.has(r));
    expect(
      sinMontar,
      "estas claves estan en el inventario y no las monta nadie. Una credencial que nadie usa es " +
        "una que hay que rotar y vigilar por un motivo que ya nadie recuerda.",
    ).toEqual([]);
  });

  /**
   * Los ocho de `app`/`owner` son **espejos**, y su origen es el `Secret` de la plataforma.
   *
   * El motivo esta en `EntradaDeSecreto.espejoDe` y es de PostgreSQL, no de gusto: `kamayuk_app` y
   * `kamayuk_owner` son roles del CLUSTER —los crea el `crear-roles.sql` de cada sistema con el
   * mismo nombre— y un rol tiene UNA contrasena. Ocho valores generados por separado dejarian a
   * siete de los ocho sin poder conectarse.
   */
  it.each(ENVIRONMENTS)("%s: las claves de un rol del cluster son espejo, no valores nuevos", (a) => {
    const inventario = inventarioDelAmbiente(invariantesDe(a));
    // Los namespaces de los CUATRO sistemas, nombrados uno a uno. Hasta la etapa D esto
    // era `namespace.startsWith("kamayuk-")`, y funcionaba solo porque el de la plataforma
    // empezaba por `sgtm-`: al renombrarlo, el mismo filtro pasaba a coger las 21 entradas
    // del ambiente en vez de las 10 de los sistemas. Un prefijo no era el criterio, era una
    // coincidencia entre dos nombres que ya no existe.
    const deLosSistemas = new Set(SISTEMAS_DEL_PRODUCTO.map((s) => namespaceDelSistema(a, s)));
    const deSistemas = inventario.filter((e) => deLosSistemas.has(e.namespace));
    // TRECE desde ADR-0039. Eran once —dos por sistema, `app` y `owner`, mas la credencial del
    // ingestor de `rentas` y su espejo—; `identidad` suma las suyas: `app` y `owner`, y ninguna
    // con `emisor`, porque ese sistema no llama a ningun hermano y no tiene cliente confidencial.
    // La cifra se toca a mano a proposito: un sistema nuevo pasa por aqui, y con el la pregunta
    // de si alguna de sus claves es un valor NUEVO en vez de la copia de un rol del cluster.
    // Y DIECISIETE desde la etapa 4 de ADR-0039 (identidad#4): cada uno de los cuatro
    // satelites declara `kamayuk-<s>-<amb>-identidad`, la clave con la que su consumidor del
    // buzon pide el token, con `emisor: "keycloak"`. Ninguna es un valor nuevo: las cuatro son
    // espejo de la clave del cliente `kamayuk-<s>-servicio-<ubigeo>`, que desde este trabajo es
    // UNA por cliente —`claveDeServicio(sistema, ubigeo)`— y no una por par, porque `rentas`
    // llama ahora a dos (`catastro` e `identidad`) con el mismo cliente. `identidad` sigue sin
    // `emisor`: sirve el buzon y no llama a nadie.
    expect(deSistemas).toHaveLength(17);

    // Trece de trece, y los dos que no son de un rol los anadio #21 AC-2: hasta entonces la credencial con la que el
    // ingestor pide el buzon de `catastro` era la unica que NO era espejo, porque no habia
    // ningun valor del que fuera copia. Ahora lo hay —la clave del cliente confidencial que el
    // Job de identidad le fija a Keycloak—, y tiene que ser el MISMO valor por el mismo motivo
    // que un rol del motor: si se generaran por separado, quien llama mandaria una y el emisor
    // esperaria otra, y el destino contestaria 401 en la primera llamada.
    const espejos = deSistemas.filter((e) => e.espejoDe !== undefined);
    expect(espejos).toHaveLength(17);
    for (const e of espejos) {
      const origen = inventario.find(
        (o) => o.secreto === e.espejoDe?.secreto && o.clave === e.espejoDe.clave,
      );
      expect(origen, `«${e.secreto}» copia de una entrada que no esta en el inventario`).toBeDefined();
      // Un espejo copia de un rol del motor —una contrasena de PostgreSQL— o de una clave de
      // cliente confidencial. Las dos son «un valor que existe en otro sitio y no se puede
      // generar dos veces»; lo que no puede es copiar de algo que no es ni una cosa ni la otra.
      const deEmisor = origen!.secreto === `kamayuk-${a}-servicios-de-identidad`;
      expect(
        origen!.rolDePostgres !== undefined || deEmisor,
        `«${e.secreto}» copia de algo que no es ni un rol del motor ni una clave de emisor`,
      ).toBe(true);
    }

    // Y ya no queda ninguna que se genere por su cuenta. La lista se afirma vacia y no se omite
    // la comprobacion: el dia que aparezca una credencial de sistema sin origen, esto la nombra.
    const propios = deSistemas.filter((e) => e.espejoDe === undefined);
    expect(propios.map((e) => e.secreto)).toEqual([]);
  });

  /**
   * Ningun espejo lleva `rolDePostgres`, y eso es lo que hace correcto a `asignar-claves.sh`.
   *
   * Ese guion recorre las entradas con `rolDePostgres` y hace un `ALTER ROLE`. Con los espejos
   * dentro haria uno por copia sobre `kamayuk_app` con valores que tienen que ser el mismo,
   * y el ultimo decidiria. Quien manda es el `Secret` de la plataforma.
   */
  it("un espejo no es una credencial que asignar: no lleva rol de PostgreSQL", () => {
    for (const e of inventarioDelAmbiente(invariantesDe("stg"))) {
      if (e.espejoDe === undefined) continue;
      expect(e.rolDePostgres, `«${e.secreto}» es espejo Y dice ser la clave de un rol`).toBeUndefined();
    }
  });

  /**
   * Ningun `Secret` mezcla claves copiadas y claves generadas.
   *
   * Es el LIMITE de como `bootstrap-secretos.sh` aplica los espejos: escribe el `Secret` entero
   * con la clave copiada dentro, asi que una clave generada en el mismo objeto se perderia. Se
   * declara en vez de descubrirse: el dia que haga falta mezclarlas, esta prueba se pone roja y
   * lo que hay que cambiar es el guion, no esta linea.
   */
  it("ningun Secret mezcla claves copiadas con claves generadas", () => {
    const porSecreto = new Map<string, Set<boolean>>();
    for (const e of inventarioDelAmbiente(invariantesDe("stg"))) {
      const llave = `${e.namespace}/${e.secreto}`;
      const clases = porSecreto.get(llave) ?? new Set<boolean>();
      clases.add(e.espejoDe !== undefined);
      porSecreto.set(llave, clases);
    }
    const mezclados = [...porSecreto.entries()].filter(([, clases]) => clases.size > 1);
    expect(mezclados.map(([llave]) => llave)).toEqual([]);
  });

  /** Y toda entrada dice donde vive: un `Secret` no cruza namespaces. */
  it.each(ENVIRONMENTS)("%s: toda entrada declara su namespace, y el del sistema es el suyo", (a) => {
    for (const e of inventarioDelAmbiente(invariantesDe(a))) {
      expect(e.namespace, `«${e.secreto}» no dice en que namespace vive`).toBeTruthy();
    }
    for (const sistema of SISTEMAS_DEL_PRODUCTO) {
      const suyas = inventarioDelAmbiente(invariantesDe(a)).filter((e) =>
        e.secreto.startsWith(`kamayuk-${sistema}-`),
      );
      expect(suyas.length).toBeGreaterThan(0);
      for (const e of suyas) expect(e.namespace).toBe(`kamayuk-${sistema}-${a}`);
    }
  });

  /** Las dos comprobaciones de siempre, ahora sobre el inventario ENTERO. */
  it.each(ENVIRONMENTS)("%s: nada se repite en el inventario completo", (a) => {
    const entradas = inventarioDelAmbiente(invariantesDe(a));
    const pares = entradas.map((e) => `${e.namespace}/${e.secreto}/${e.clave}`);
    expect(new Set(pares).size).toBe(pares.length);
    const roles = entradas.map((e) => e.rol);
    expect(new Set(roles).size).toBe(roles.length);
  });
});
