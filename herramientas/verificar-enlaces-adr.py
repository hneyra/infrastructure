#!/usr/bin/env python3
"""
Cero enlaces relativos rotos en los cinco repositorios.

QUE COMPRUEBA, Y QUE NO
Comprueba los enlaces **relativos**: los resuelve contra el disco y exige que el archivo
exista. Es lo que el corte rompe —un ADR que se muda deja atras todo lo que enlazaba por
ruta— y lo que se puede verificar sin red.

**NO comprueba los absolutos**, y hay que decirlo en vez de dar la impresion de que si: un
`https://github.com/...` mal escrito, o el de un repositorio que no existe, pasa por aqui
sin ruido. Lo que los sostiene es la suposicion de `repartir-adr.py` —los cinco repositorios
en la misma organizacion— y esa suposicion no la mide nadie todavia.

Tampoco comprueba las anclas (`#seccion`): un `#` que no existe deja el enlace navegando al
principio del documento, que es un defecto menor y de otra clase.
"""
import re
import sys
from pathlib import Path

REPOS = ["infrastructure", "rentas", "catastro", "normativa", "caja", "sgtm"]
RAIZ = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()

ENLACE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
rotos: list[str] = []
revisados = 0
por_repo: dict[str, tuple[int, int]] = {}

for repo in REPOS:
    carpeta = RAIZ / repo / "docs/30-arquitectura/adr"
    if not carpeta.is_dir():
        por_repo[repo] = (0, 0)
        continue
    n_repo = r_repo = 0
    for md in sorted(carpeta.glob("*.md")):
        for m in ENLACE.finditer(md.read_text(encoding="utf-8")):
            destino = m.group(1)
            if destino.startswith(("http://", "https://", "#", "mailto:")):
                continue
            revisados += 1
            n_repo += 1
            ruta = (md.parent / destino.split("#", 1)[0]).resolve()
            if not ruta.exists():
                rotos.append(f"{repo}/{md.name}: «{destino}»")
                r_repo += 1
    por_repo[repo] = (n_repo, r_repo)

print("Enlaces RELATIVOS en los ADR de cada repositorio\n")
print(f"  {'repositorio':16s} {'revisados':>10s} {'rotos':>7s}")
for repo in REPOS:
    n, r = por_repo[repo]
    print(f"  {repo:16s} {n:10d} {r:7d}" + ("" if r == 0 else "   <-- ROJO"))
print(f"  {'TOTAL':16s} {revisados:10d} {len(rotos):7d}")

if rotos:
    print("\nRotos:")
    for x in rotos:
        print(f"  - {x}")
    sys.exit(1)
print("\nCERO enlaces relativos rotos.")
