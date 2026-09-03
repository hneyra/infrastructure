#!/usr/bin/env python3
"""
Que los 32 ADR esten repartidos, que ninguno este en dos con contenido, y que el estado de
cada uno sea el mismo que tenia en `sgtm`.

Las tres cosas se leen de los archivos, no de una lista escrita a mano: una lista se
actualiza sola en la cabeza de quien la escribio.
"""
import hashlib
import re
import sys
from pathlib import Path

REPOS = ["infrastructure", "rentas", "catastro", "normativa", "caja"]
REL = "docs/30-arquitectura/adr"
RAIZ = Path(sys.argv[1]).resolve()
ORIGEN = RAIZ / "sgtm" / REL


def estado_de(texto: str) -> str:
    m = re.search(r"^\*\*Estado:\*\* *(.+)$", texto, re.M)
    if m:
        return m.group(1).strip()
    m = re.search(r"^\| Estado \| *(.+?) *\|$", texto, re.M)
    return m.group(1).strip() if m else "(sin estado)"


originales = {p.name[4:8]: p for p in sorted(ORIGEN.glob("ADR-*.md"))}
copias: dict[str, list[str]] = {}
for repo in REPOS:
    for p in sorted((RAIZ / repo / REL).glob("ADR-*.md")):
        copias.setdefault(p.name[4:8], []).append(repo)

fallos = 0

# 1. Los 32 estan en algun repositorio (o se quedan en `sgtm`, declarado).
SE_QUEDAN = {"0009", "0010"}
sin_destino = [n for n in originales if n not in copias and n not in SE_QUEDAN]
print(f"1. Los {len(originales)} ADR tienen destino: ", end="")
print("OK" if not sin_destino else f"ROJO, sin destino: {sin_destino}")
fallos += bool(sin_destino)

# 2. Ninguno en dos repositorios con contenido.
dobles = {n: r for n, r in copias.items() if len(r) > 1}
en_sgtm_y_fuera = [n for n in copias if n in SE_QUEDAN]
print("2. Ninguno en dos con contenido:      ", end="")
print("OK" if not dobles and not en_sgtm_y_fuera
      else f"ROJO: {dobles or ''} {en_sgtm_y_fuera or ''}")
fallos += bool(dobles or en_sgtm_y_fuera)

# 3. El estado de cada uno es el que tenia en `sgtm`.
print("3. El estado no cambio al mudarlo:")
print(f"   {'#':>4}  {'estado en sgtm':22s} {'estado en destino':22s} {'repositorio':16s} cuerpo")
distintos = 0
for n in sorted(originales):
    texto_o = originales[n].read_text(encoding="utf-8")
    e_o = estado_de(texto_o)
    if n in SE_QUEDAN:
        print(f"   {n}  {e_o:22s} {e_o:22s} {'sgtm':16s} (se queda)")
        continue
    repo = copias[n][0]
    texto_c = (RAIZ / repo / REL / originales[n].name).read_text(encoding="utf-8")
    e_c = estado_de(texto_c)
    # El cuerpo, sin los enlaces: lo que NO puede cambiar al mudar es la decision.
    sin_enlaces = lambda t: hashlib.sha256(
        re.sub(r"\]\([^)]*\)", "]()", t).encode("utf-8")).hexdigest()[:12]
    igual = sin_enlaces(texto_o) == sin_enlaces(texto_c)
    marca = "" if e_o == e_c else "   <-- DISTINTO"
    if e_o != e_c or not igual:
        distintos += 1
        marca += "" if igual else "   <-- CUERPO EDITADO"
    print(f"   {n}  {e_o:22s} {e_c:22s} {repo:16s} {'identico' if igual else 'EDITADO'}{marca}")
fallos += bool(distintos)
print(f"\n   {len(originales)} comparados, {distintos} con estado o cuerpo distinto.")

sys.exit(1 if fallos else 0)
