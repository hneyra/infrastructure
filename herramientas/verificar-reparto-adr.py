#!/usr/bin/env python3
"""
Que los 32 ADR esten repartidos, que ninguno este en dos con contenido, que el estado de cada
uno sea el mismo que tenia en `sgtm`, y que el indice de cada repositorio diga la verdad.

Las cuatro cosas se leen de los archivos, no de una lista escrita a mano: una lista se
actualiza sola en la cabeza de quien la escribio.

LA GUARDA TIENE QUE PODER FALLAR
La version anterior leia `sys.argv[1]` sin comprobar nada: apuntada a una raiz equivocada,
`originales` salia vacio, los tres apartados pasaban sobre cero archivos y el guion salia en
VERDE. Ahora la raiz es obligatoria y se comprueba que haya ADR que comparar.
"""
import hashlib
import re
import sys
from pathlib import Path

REPOS = ["infrastructure", "rentas", "catastro", "normativa", "caja"]
REL = "docs/30-arquitectura/adr"
ORG = "https://github.com/hneyra"
# Se quedan en `sgtm` con contenido: `docs/60-frontend/` no se ha portado, asi que la decision
# de la interfaz sigue viviendo donde vive su codigo (GOB-05 §4.3).
SE_QUEDAN = {"0009", "0010"}

# Los que la copia viva PUEDE tener distintos de `sgtm`, con el motivo y la fecha.
#
# `sgtm` es el archivo historico: quedo congelado el dia del corte y NO SE MODIFICA. La copia
# viva sigue su ciclo, asi que una divergencia deja de ser un defecto EN CUANTO alguien la
# declara aqui. Lo que esta lista NO admite es una divergencia sin motivo: esa sigue siendo
# roja, que es lo que esta comprobacion existe para cazar.
#
# Y no admite entradas rancias: si un ADR de aqui vuelve a estar identico, la comprobacion lo
# dice y hay que retirarlo. Una excusa que ya no excusa nada es una excusa que tapa la
# siguiente.
DIVERGEN_A_PROPOSITO = {
    "0003": "2026-09-04 · Obsoleto: D-22 se contesto «lo opera un equipo central» y ADR-0029 lo reemplaza",
    "0024": "2026-09-04 · Aceptado al contestar D-22",
    "0025": "2026-09-04 · Aceptado al contestar D-22",
    "0026": "2026-09-04 · Aceptado al contestar D-22",
    "0027": "2026-09-04 · Aceptado al contestar D-22",
    "0028": "2026-09-04 · Aceptado al contestar D-22",
    "0029": "2026-09-04 · Aceptado al contestar D-22",
    "0030": "2026-09-04 · Aceptado al contestar D-22",
    "0031": "2026-09-04 · Aceptado al contestar D-22",
    "0032": "2026-09-04 · Aceptado al contestar D-22",
}

if len(sys.argv) < 2:
    print("uso: verificar-reparto-adr.py <raiz que contiene los seis repositorios>",
          file=sys.stderr)
    print("     la raiz es OBLIGATORIA: sin ella `originales` sale vacio y los apartados "
          "pasan sobre cero archivos.", file=sys.stderr)
    sys.exit(2)

RAIZ = Path(sys.argv[1]).resolve()
ORIGEN = RAIZ / "sgtm" / REL


def estado_de(texto: str) -> str:
    m = re.search(r"^\*\*Estado:\*\* *(.+)$", texto, re.M)
    if m:
        return m.group(1).strip()
    m = re.search(r"^\| Estado \| *(.+?) *\|$", texto, re.M)
    return m.group(1).strip() if m else "(sin estado)"


def seccion(texto: str, titulo_empieza_por: str) -> str:
    """El cuerpo de la seccion `## <titulo…>` del README, hasta el siguiente `## `."""
    partes = re.split(r"^## ", texto, flags=re.M)
    for p in partes[1:]:
        if p.startswith(titulo_empieza_por):
            return p
    return ""


originales = {p.name[4:8]: p for p in sorted(ORIGEN.glob("ADR-*.md"))}
fallos = 0

# 0. Que haya algo que comparar. Sin esto, todo lo de abajo pasa sobre el conjunto vacio.
faltan = [r for r in REPOS + ["sgtm"] if not (RAIZ / r / REL).is_dir()]
print("0. La raiz contiene los seis repositorios y sus ADR: ", end="")
if faltan or not originales:
    print(f"ROJO. Sin `{REL}` en: {faltan or '(ninguno)'}; "
          f"{len(originales)} ADR en `sgtm`. La raiz «{RAIZ}» no es la buena.")
    sys.exit(1)
print(f"OK ({len(originales)} ADR en `sgtm`)")

copias: dict[str, list[str]] = {}
for repo in REPOS:
    for p in sorted((RAIZ / repo / REL).glob("ADR-*.md")):
        copias.setdefault(p.name[4:8], []).append(repo)

# 1. Los 32 estan en algun repositorio (o se quedan en `sgtm`, declarado).
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
declarados = 0
rancios: list[str] = []
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
    difiere = e_o != e_c or not igual
    declarado = n in DIVERGEN_A_PROPOSITO
    if difiere and declarado:
        declarados += 1
        marca = "   <-- declarado: " + DIVERGEN_A_PROPOSITO[n]
    elif difiere:
        distintos += 1
        marca = "   <-- DISTINTO" if e_o != e_c else ""
        marca += "" if igual else "   <-- CUERPO EDITADO"
    else:
        marca = ""
        if declarado:
            rancios.append(n)
    print(f"   {n}  {e_o:22s} {e_c:22s} {repo:16s} {'identico' if igual else 'EDITADO'}{marca}")
fallos += bool(distintos)
print(f"\n   {len(originales)} comparados, {distintos} con divergencia SIN DECLARAR, "
      f"{declarados} declarada(s).\n")
if rancios:
    fallos += 1
    print("   ROJO: estos estan declarados en DIVERGEN_A_PROPOSITO y ya son identicos.")
    print("   Una excusa que ya no excusa nada tapa la siguiente. Retiralos:")
    for n in rancios:
        print(f"     - {n}: {DIVERGEN_A_PROPOSITO[n]}")
    print()

# 4. El indice de cada repositorio dice la verdad: lista lo que aloja, no lista lo que no
#    aloja, y los que enlaza apuntan al repositorio que de verdad los tiene.
#    Sin esto la tabla del README envejece sola, que es como se llega a dos fuentes de verdad.
print("4. El indice de cada repositorio coincide con el disco:")
print(f"   {'repositorio':16s} {'aloja':>6s} {'listados':>9s} {'enlaza':>7s}  veredicto")
DUENO = {n: r[0] for n, r in copias.items()}
malos = 0
for repo in REPOS:
    carpeta = RAIZ / repo / REL
    en_disco = {p.name[4:8] for p in carpeta.glob("ADR-*.md")}
    texto = (carpeta / "README.md").read_text(encoding="utf-8")
    propios = set(re.findall(r"^\| \[(\d{4})\]\(ADR-", seccion(texto, "Los de este"), re.M))
    sec_enlaza = seccion(texto, "Los que enlaza")
    enlazados = dict(re.findall(
        rf"^\| \[(\d{{4}})\]\({re.escape(ORG)}/([a-z]+)/blob/", sec_enlaza, re.M))
    quejas = []
    if propios != en_disco:
        quejas.append(f"lista {sorted(propios) or '(nada)'} y en disco hay "
                      f"{sorted(en_disco) or '(nada)'}")
    if propios & set(enlazados):
        quejas.append(f"aloja Y enlaza los mismos: {sorted(propios & set(enlazados))}")
    mal_dirigidos = {n: (d, DUENO.get(n, "sgtm")) for n, d in enlazados.items()
                     if DUENO.get(n, "sgtm") != d}
    if mal_dirigidos:
        quejas.append(f"enlaza a quien no lo tiene: {mal_dirigidos}")
    print(f"   {repo:16s} {len(en_disco):6d} {len(propios):9d} {len(enlazados):7d}  "
          + ("OK" if not quejas else "ROJO: " + "; ".join(quejas)))
    malos += bool(quejas)
fallos += bool(malos)

sys.exit(1 if fallos else 0)
