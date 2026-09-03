#!/usr/bin/env python3
"""
Reparte los ADR de `sgtm` entre los cinco repositorios, sin editarlos y sin dejar dos
fuentes de verdad.

QUE HACE Y QUE NO
- Copia cada ADR a UN solo repositorio. Ninguno queda en dos con contenido.
- **No toca el cuerpo de la decision.** Lo unico que reescribe son los ENLACES, que es lo
  que el corte obliga a rehacer: un enlace roto en un ADR es un ADR que nadie podra seguir.
  Si una decision cambio, se escribe otro ADR que declare obsoleto al anterior — es la regla
  del propio `adr/README.md`, y este guion no la puede sustituir.
- No borra nada de `sgtm`: es el archivo historico y la unica copia con `git log`.

COMO REESCRIBE LOS ENLACES
  1. A otro ADR del MISMO repositorio  -> relativo, tal cual estaba.
  2. A un ADR de OTRO repositorio      -> URL absoluta a ese repositorio.
  3. A un documento que sigue en `sgtm` -> URL absoluta a `sgtm`, rama de la migracion.
  4. A `../../../despliegue/...`        -> relativo en `infrastructure`, que ya lo tiene;
                                           absoluto a `infrastructure` en los demas.

La suposicion que esto lleva dentro, y hay que verla: los cinco repositorios viven en la
misma organizacion de GitHub que `sgtm` (`hneyra`). Si no fuera asi, las URL de (2) y (4)
apuntan a donde no es — y el verificador de enlaces NO lo detecta, porque solo comprueba los
relativos.
"""
import json
import re
import shutil
import sys
from pathlib import Path

ORG = "https://github.com/hneyra"
RAMA_SGTM = "blob/migracion-a-microservicios"
RAMA = "blob/main"

RAIZ_SGTM = Path(sys.argv[1]).resolve()
RAIZ_REPOS = RAIZ_SGTM.parent
REPARTO = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))

ORIGEN = RAIZ_SGTM / "docs/30-arquitectura/adr"
RELATIVO = "docs/30-arquitectura/adr"

# numero de ADR -> repositorio que lo aloja
DUENO = {n: repo for repo, ns in REPARTO.items() for n in ns}
ARCHIVOS = {p.name[4:8]: p for p in sorted(ORIGEN.glob("ADR-*.md"))}


def destino_de_adr(numero: str, repo_actual: str) -> str | None:
    """El enlace a otro ADR, desde el repositorio que lo enlaza."""
    dueno = DUENO.get(numero)
    if dueno is None:
        return None
    if dueno == repo_actual:
        return None  # relativo: se queda como esta
    rama = RAMA_SGTM if dueno == "sgtm" else RAMA
    return f"{ORG}/{dueno}/{rama}/{RELATIVO}/{ARCHIVOS[numero].name}"


def reescribir(texto: str, repo: str) -> tuple[str, int]:
    cambios = 0

    def a_otro_adr(m: re.Match[str]) -> str:
        nonlocal cambios
        destino = m.group(1)
        numero = destino[4:8]
        url = destino_de_adr(numero, repo)
        if url is None:
            return m.group(0)
        cambios += 1
        return f"]({url}{m.group(2) or ''})"

    texto = re.sub(r"\]\((ADR-\d{4}-[a-z0-9-]+\.md)(#[^)]*)?\)", a_otro_adr, texto)

    def a_sgtm(m: re.Match[str]) -> str:
        nonlocal cambios
        ruta = m.group(1)
        # `../../../x` sale de `docs/30-arquitectura/adr` a la raiz del repositorio.
        # `../../x` sale a `docs/`. `../x` se queda en `30-arquitectura/`.
        if ruta.startswith("../../../"):
            resto = ruta[len("../../../"):]
            if resto.startswith("despliegue/"):
                if repo == "infrastructure":
                    return m.group(0)  # infrastructure ya lo tiene: relativo vale
                cambios += 1
                return f"]({ORG}/infrastructure/{RAMA}/{resto})"
            base = ""
        elif ruta.startswith("../../"):
            resto, base = ruta[len("../../"):], "docs/"
        else:
            resto, base = ruta[len("../"):], "docs/30-arquitectura/"
        cambios += 1
        return f"]({ORG}/sgtm/{RAMA_SGTM}/{base}{resto})"

    texto = re.sub(r"\]\((\.\./[^)]+)\)", a_sgtm, texto)
    return texto, cambios


def main() -> None:
    total = 0
    for repo, numeros in REPARTO.items():
        if repo == "sgtm" or not numeros:
            continue
        carpeta = RAIZ_REPOS / repo / RELATIVO
        carpeta.mkdir(parents=True, exist_ok=True)
        for n in numeros:
            origen = ARCHIVOS[n]
            texto, cambios = reescribir(origen.read_text(encoding="utf-8"), repo)
            (carpeta / origen.name).write_text(texto, encoding="utf-8")
            total += 1
            print(f"  {repo:16s} {origen.name}  ({cambios} enlace(s) rehecho(s))")
    print(f"\n{total} ADR copiados. En `sgtm` se quedan {len(REPARTO['sgtm'])} con contenido, "
          f"y los 32 originales intactos.")


if __name__ == "__main__":
    main()
