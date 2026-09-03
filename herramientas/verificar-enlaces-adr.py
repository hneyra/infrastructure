#!/usr/bin/env python3
"""
Cero enlaces rotos en los ADR de los cinco repositorios.

QUE COMPRUEBA, Y QUE NO

1. **Enlaces relativos.** Los resuelve contra el disco y exige que el archivo exista. Es lo
   que el corte rompe —un ADR que se muda deja atras todo lo que enlazaba por ruta—.

2. **Enlaces absolutos a nuestros propios repositorios** (`github.com/hneyra/<repo>/blob/...`).
   Se resuelven contra el repositorio hermano en disco. Esta mitad no estaba, y su ausencia
   NO era inofensiva: `repartir-adr.py` convierte un enlace relativo en uno absoluto al mudar
   el ADR, de modo que **un relativo roto se muda como absoluto roto y desaparece de la
   comprobacion**. Es exactamente lo que paso con `ADR-0013`, y se veia contando: 162
   absolutos a repositorios propios, 161 resuelven, 1 no.

3. Lo que **no** se puede comprobar sin red, y se dice en vez de callarlo: los absolutos a
   destinos que no son un archivo de estos seis repositorios —los `issues/NNN` y el ADR del
   `srtm`—. Se cuentan y se listan aparte; nadie los valida.

Tampoco comprueba las anclas (`#seccion`): un `#` que no existe deja el enlace navegando al
principio del documento, que es un defecto menor y de otra clase.

LA GUARDA TIENE QUE PODER FALLAR
La version anterior tomaba la raiz de `sys.argv[1]` **o del directorio actual**, asi que
corrida sin argumento desde cualquier sitio revisaba 0 archivos y salia en verde diciendo
«CERO enlaces relativos rotos». Ahora la raiz es obligatoria y, ademas, se comprueba que haya
algo que revisar: sin las seis carpetas y sin enlaces de las dos clases, el guion sale ROJO.
"""
import re
import sys
from pathlib import Path

REPOS_NUEVOS = ["infrastructure", "rentas", "catastro", "normativa", "caja"]
REPOS = REPOS_NUEVOS + ["sgtm"]
REL = "docs/30-arquitectura/adr"

# Enlaces rotos ya medidos, con su motivo. La lista es corta a proposito: cada entrada es una
# renuncia, y una renuncia sin motivo escrito es un defecto escondido.
CONOCIDOS = {
    "sgtm|../../../frontend/packages/sesion/src/permisos.ts":
        "PREEXISTENTE, y NO se arregla aqui. `frontend/packages/sesion/` era la interfaz con "
        "yarn workspaces; la reimplementacion del 2026-09-01 la sustituyo por un solo paquete "
        "y ese archivo no existe. Arreglarlo seria un segundo cambio en `sgtm`, y la etapa P2 "
        "solo permite uno (la nota de `adr/README.md`).",
    "rentas|https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/frontend/packages/sesion/src/permisos.ts":
        "El MISMO de arriba, mudado. `repartir-adr.py` lo reescribio a absoluto al copiar "
        "ADR-0013 a `rentas`, asi que apunta al mismo archivo inexistente. No se corrige en "
        "el destino: un ADR no se edita al mudarlo, y el original sigue diciendo lo mismo.",
}

if len(sys.argv) < 2:
    print("uso: verificar-enlaces-adr.py <raiz que contiene los seis repositorios>",
          file=sys.stderr)
    print("     la raiz es OBLIGATORIA: sin ella el guion revisaria 0 archivos y saldria en "
          "verde sin haber mirado nada.", file=sys.stderr)
    sys.exit(2)

RAIZ = Path(sys.argv[1]).resolve()

ENLACE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
PROPIO = re.compile(
    r"^https://github\.com/hneyra/(sgtm|infrastructure|rentas|catastro|normativa|caja)"
    r"/blob/(?:main|migracion-a-microservicios)/(.+)$")

rotos: list[tuple[str, str, str]] = []      # (repo, archivo, destino)
exentos: list[tuple[str, str, str]] = []
sin_comprobar: set[str] = set()
por_repo: dict[str, list[int]] = {}          # repo -> [relativos, absolutos propios, rotos]
faltan_carpetas: list[str] = []

for repo in REPOS:
    carpeta = RAIZ / repo / REL
    if not carpeta.is_dir():
        faltan_carpetas.append(repo)
        por_repo[repo] = [0, 0, 0]
        continue
    n_rel = n_abs = n_rot = 0
    for md in sorted(carpeta.glob("*.md")):
        for m in ENLACE.finditer(md.read_text(encoding="utf-8")):
            destino = m.group(1)
            if destino.startswith(("#", "mailto:")):
                continue
            if destino.startswith(("http://", "https://")):
                g = PROPIO.match(destino)
                if not g:
                    sin_comprobar.add(destino)
                    continue
                n_abs += 1
                ruta = RAIZ / g.group(1) / g.group(2).split("#", 1)[0]
            else:
                n_rel += 1
                ruta = (md.parent / destino.split("#", 1)[0]).resolve()
            if ruta.exists():
                continue
            if f"{repo}|{destino}" in CONOCIDOS:
                exentos.append((repo, md.name, destino))
            else:
                rotos.append((repo, md.name, destino))
                n_rot += 1
    por_repo[repo] = [n_rel, n_abs, n_rot]

print("Enlaces en los ADR de cada repositorio\n")
print(f"  {'repositorio':16s} {'relativos':>10s} {'absolutos':>10s} {'rotos':>7s}")
for repo in REPOS:
    n_rel, n_abs, n_rot = por_repo[repo]
    marca = "" if n_rot == 0 else "   <-- ROJO"
    print(f"  {repo:16s} {n_rel:10d} {n_abs:10d} {n_rot:7d}{marca}")
tot_rel = sum(v[0] for v in por_repo.values())
tot_abs = sum(v[1] for v in por_repo.values())
print(f"  {'TOTAL':16s} {tot_rel:10d} {tot_abs:10d} {len(rotos):7d}")
print("\n  «absolutos» = los que apuntan a un archivo de estos seis repositorios y SI se "
      "resuelven contra el disco.")

# La guarda tiene que poder fallar: si no hay nada que revisar, esto es ROJO, no verde.
problemas = 0
if faltan_carpetas:
    print(f"\nROJO: no existe `{REL}` en: {', '.join(faltan_carpetas)}. La raiz «{RAIZ}» no "
          f"parece contener los seis repositorios.")
    problemas += 1
if tot_rel == 0 or tot_abs == 0:
    print(f"\nROJO: no hay nada que revisar ({tot_rel} relativos, {tot_abs} absolutos "
          f"propios). Una comprobacion sobre cero archivos no comprueba nada.")
    problemas += 1

if exentos:
    print(f"\nRotos CONOCIDOS y declarados ({len(exentos)}), que no ponen esto en rojo:")
    for repo, archivo, destino in exentos:
        print(f"  - {repo}/{archivo}: «{destino}»")
        print(f"      {CONOCIDOS[f'{repo}|{destino}']}")

if sin_comprobar:
    print(f"\nAbsolutos que NADIE valida ({len(sin_comprobar)}): no son un archivo de estos "
          f"seis repositorios, asi que no se pueden resolver en disco.")
    for x in sorted(sin_comprobar):
        print(f"  - {x}")

if rotos:
    print(f"\nROTOS ({len(rotos)}):")
    for repo, archivo, destino in rotos:
        print(f"  - {repo}/{archivo}: «{destino}»")
    problemas += 1

nuevos_rotos = [r for r in rotos if r[0] in REPOS_NUEVOS]
print(f"\nEn los CINCO repositorios nuevos: {len(nuevos_rotos)} enlaces rotos "
      f"(sin contar los {len(exentos)} declarados arriba).")
if problemas:
    sys.exit(1)
print("CERO enlaces rotos no declarados.")
