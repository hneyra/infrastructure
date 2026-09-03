#!/usr/bin/env python3
"""Comprueba que ningun enlace de los documentos que se le pasan este roto.

   Dos clases de enlace, y cada una se comprueba de la forma en que SE PUEDE comprobar:

     · relativo  -> el archivo tiene que existir en el disco, y el ancla `#seccion`,
                    si la lleva, tiene que corresponder a un titulo del destino.
     · absoluto a github.com/hneyra/<repo>/blob/<rama>/<ruta>
                 -> se resuelve contra el CLON HERMANO de ese repositorio. Es una
                    comprobacion mas fuerte que una peticion HTTP: dice si el archivo
                    existe de verdad, y no depende de que el repositorio sea publico ni
                    de que haya red. Lo que NO comprueba es que la rama remota ya lo
                    tenga; eso se declara en vez de fingirse.

   Un enlace a otro dominio se cuenta aparte y no se sigue.

   Uso:  python3 herramientas/verificar-enlaces.py <archivo.md> [...]
"""
import pathlib
import re
import sys
import unicodedata

ENLACE = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
GITHUB = re.compile(r"^https://github\.com/hneyra/([^/]+)/(?:blob|tree)/[^/]+/(.*)$")
HERMANOS = pathlib.Path(__file__).resolve().parent.parent.parent


def ancla(titulo: str) -> str:
    t = unicodedata.normalize("NFKD", titulo.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^\w\s-]", "", t)
    return re.sub(r"\s+", "-", t.strip())


def anclas_de(destino: pathlib.Path) -> set[str]:
    if destino.suffix != ".md" or not destino.is_file():
        return set()
    return {
        ancla(linea.lstrip("#").strip())
        for linea in destino.read_text(encoding="utf8").splitlines()
        if linea.startswith("#")
    }


rotos, externos, comprobados = [], 0, 0

for argumento in sys.argv[1:]:
    documento = pathlib.Path(argumento).resolve()
    texto = documento.read_text(encoding="utf8")
    for destino in ENLACE.findall(texto):
        if destino.startswith("#"):
            continue
        ruta, _, seccion = destino.partition("#")
        coincidencia = GITHUB.match(ruta)
        if coincidencia:
            repo, dentro = coincidencia.groups()
            objetivo = HERMANOS / repo / dentro
            if not (HERMANOS / repo).is_dir():
                externos += 1
                continue
        elif ruta.startswith("http"):
            externos += 1
            continue
        else:
            objetivo = (documento.parent / ruta).resolve()
        comprobados += 1
        if not objetivo.exists():
            rotos.append(f"{documento.name}: no existe {destino}")
        elif seccion and objetivo.suffix == ".md" and seccion not in anclas_de(objetivo):
            rotos.append(f"{documento.name}: {objetivo.name} no tiene el ancla #{seccion}")

print(f"{comprobados} enlaces resueltos contra el disco, {externos} externos no seguidos.")
if rotos:
    print(f"\nFALLO: {len(rotos)} enlaces rotos.")
    for r in rotos:
        print(f"  · {r}")
    sys.exit(1)
print("Ninguno roto.")
