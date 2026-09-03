#!/usr/bin/env python3
"""
Escribe el `adr/README.md` de cada repositorio: su tabla, su estado y su plantilla.

    uso: indices-adr.py <raiz> [reparto-adr.json]

DOS COSAS QUE NO ESTABAN, Y POR QUE

**El estado y el titulo se derivan de los propios ADR**, no de un tercer archivo escrito a
mano. La version anterior los leia de un `n|estado|titulo` que se le pasaba por argumento y
que **no esta en el repositorio**: el guion no se podia volver a ejecutar, y una lista de 32
estados escrita a mano envejece sola. Ahora salen del `**Estado:**` (o de la fila `| Estado |`)
y del `# ADR-NNNN — ...` de cada archivo de `sgtm`, que es donde viven.

**Se niega a pisar un README con secciones que el no genera.** Este guion SOBRESCRIBE, y el
`README.md` de `infrastructure` lleva a mano el entregable de la etapa P2 —la tabla de estado
de los 32, la salida de los verificadores, los huecos declarados—. Volver a ejecutarlo sin esta
guarda se lo llevaria por delante sin decir nada.
"""
import json
import re
import sys
from pathlib import Path

ORG = "https://github.com/hneyra"
RAMA_SGTM = "blob/migracion-a-microservicios"
RAMA = "blob/main"
REL = "docs/30-arquitectura/adr"

if len(sys.argv) < 2:
    print("uso: indices-adr.py <raiz> [reparto-adr.json]", file=sys.stderr)
    sys.exit(2)

RAIZ = Path(sys.argv[1]).resolve()
REPARTO = json.loads(Path(
    sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent / "reparto-adr.json"
).read_text(encoding="utf-8"))

ORIGEN = RAIZ / "sgtm" / REL
ARCHIVOS = {p.name[4:8]: p.name for p in sorted(ORIGEN.glob("ADR-*.md"))}
if not ARCHIVOS:
    print(f"ROJO: no hay ningun ADR en {ORIGEN}. La raiz no es la buena.", file=sys.stderr)
    sys.exit(1)


def _estado_y_titulo(ruta: Path) -> tuple[str, str]:
    texto = ruta.read_text(encoding="utf-8")
    m = (re.search(r"^\*\*Estado:\*\* *(.+)$", texto, re.M)
         or re.search(r"^\| Estado \| *(.+?) *\|$", texto, re.M))
    estado = m.group(1).strip() if m else "(sin estado)"
    h1 = re.search(r"^# ADR-\d{4} +[—-] +(.+)$", texto, re.M)
    return estado, (h1.group(1).strip() if h1 else ruta.name)


ESTADOS = {n: _estado_y_titulo(ORIGEN / a) for n, a in ARCHIVOS.items()}
DUENO = {n: r for r, ns in REPARTO.items() for n in ns}

# Lo que cada repositorio ENLAZA sin alojar, con el motivo de por que le importa.
ENLAZA = {
    "infrastructure": {},
    "rentas": {
        "0001": "la plataforma del backend que corre",
        "0002": "el aislamiento, que es el riesgo numero uno",
        "0004": "el motor y su particionado por ejercicio",
        "0005": "quien autentica; su modelo de permisos lo conserva ADR-0013",
        "0008": "la observacion obligatoria (regla 10)",
        "0027": "la valuacion que recibe de catastro y con la que determina",
        "0028": "el tenant no cruza por HTTP",
        "0029": "por que hay cuatro sistemas",
        "0030": "su frontend, y el portal del ciudadano",
        "0032": "su baseline",
        "0007": "el conjunto sellado con que determina",
        "0018": "el redondeo, que aplica al determinar",
    },
    "catastro": {
        "0001": "la plataforma del backend que corre",
        "0002": "el aislamiento, que es el riesgo numero uno",
        "0004": "el motor y su particionado",
        "0008": "la observacion obligatoria (regla 10)",
        "0015": "la conciliacion, que **sirve rentas** y su ficha alimenta",
        "0019": "que la porcion sin titular no se determina: su titularidad es el insumo",
        "0024": "la frontera del calculo: hasta donde llega su fase 1",
        "0028": "el tenant no cruza por HTTP",
        "0029": "por que hay cuatro sistemas",
        "0030": "su frontend",
        "0032": "su baseline",
        "0007": "el conjunto sellado con que valoriza",
        "0017": "los tres cuadros nacionales que consume",
        "0018": "el redondeo, que aplica al valorizar",
    },
    "normativa": {
        "0001": "la plataforma del backend que corre",
        "0002": "el aislamiento, que es el riesgo numero uno",
        "0004": "el motor",
        "0008": "la observacion obligatoria (regla 10)",
        "0028": "el tenant no cruza por HTTP",
        "0029": "por que hay cuatro sistemas",
        "0030": "su frontend",
        "0032": "su baseline",
    },
    "caja": {
        "0001": "la plataforma del backend que corre",
        "0002": "el aislamiento, que es el riesgo numero uno",
        "0004": "el motor",
        "0008": "la observacion obligatoria (regla 10)",
        "0026": "**el camino del dinero**: lo decide rentas, y es lo que caja ejecuta",
        "0028": "el tenant no cruza por HTTP",
        "0029": "por que hay cuatro sistemas",
        "0030": "su frontend",
        "0032": "su baseline",
    },
}

CABECERA = {
    "infrastructure": (
        "Las decisiones de la **plataforma**, y las que aplican a los cuatro sistemas.\n\n"
        "**Un ADR que vale para todos vive aqui y los demas lo enlazan; no lo copian.** Dos "
        "copias de un ADR son dos ADR distintos el dia que alguien edite una."
    ),
    "rentas": (
        "Las decisiones de **Rentas**: la determinacion, el libro de asientos, los valores, la "
        "fiscalizacion, la coactiva, las sanciones y las licencias.\n\n"
        "Aloja tambien las **tres decisiones de frontera que toma rentas** —la conciliacion "
        "(0015), la frontera del calculo (0024) y el camino del dinero (0026)—: viven donde vive "
        "la decision, y catastro y caja las enlazan."
    ),
    "catastro": (
        "Las decisiones del **Catastro Fiscal**: el predio, su geometria, su visor y la forma en "
        "que publica lo que valoriza.\n\n"
        "Aloja **ADR-0027**, la valuacion sellada: lo que catastro publica es un hecho suyo, y "
        "rentas lo enlaza."
    ),
    "normativa": (
        "Las decisiones de los **valores normativos**: que se sella, cuando, con que doble firma "
        "y con que redondeo.\n\n"
        "Las cuatro son de aqui porque aqui vive el dato: `catastro` y `rentas` **consumen** un "
        "conjunto sellado, no deciden como se sella."
    ),
    "caja": (
        "**Ninguna decision propia todavia**, y es correcto que se vea asi en vez de inventarle "
        "una: lo que la caja hace lo deciden dos ADR que no son suyos —el camino del dinero "
        "(0026), que decide `rentas` porque la imputacion es suya, y el contexto de municipalidad "
        "(0028), que es de la plataforma—.\n\n"
        "La primera decision propia llegara con **D-17**: a quien se le cobra lo que no es "
        "tributo, cuando la caja cobre un puesto de mercado o un nicho."
    ),
}

PLANTILLA = """## Plantilla

```markdown
# ADR-000X — Titulo

**Estado:** Propuesto | Aceptado | Obsoleto (reemplazado por ADR-000Y)
**Fecha:** AAAA-MM-DD

## Contexto
## Decision
## Consecuencias
## Alternativas consideradas
```

El estado tambien puede ir como fila de una tabla de metadatos (`| Estado | Aceptado |`), que es
la forma de ADR-0017 en adelante; lo que no cambia es el vocabulario: **Propuesto**, **Aceptado**
u **Obsoleto**, siempre con esa letra.

## La numeracion NO se reinicia

El ADR nuevo de este repositorio es el **0033**, no el 0001. Los treinta y dos existen y estan
repartidos; empezar de nuevo daria dos `ADR-0001` distintos en el mismo producto, y el dia que
alguien cite «ADR-0004» habria que preguntar de cual habla.
"""

for repo, numeros in REPARTO.items():
    if repo == "sgtm":
        continue
    carpeta = RAIZ / repo / REL
    carpeta.mkdir(parents=True, exist_ok=True)
    l = ["# Decisiones de arquitectura (ADR)", "", CABECERA[repo], "",
         "Un ADR registra una decision con su contexto y sus consecuencias. **No se editan una vez",
         "aceptados**: si una decision cambia, se escribe otro ADR que declare obsoleto al anterior. El",
         "historial de por que se hizo algo vale mas que la coherencia del documento.", ""]
    if numeros:
        l += ["## Los de este repositorio", "", "| # | Decision | Estado |", "|---|---|---|"]
        for n in numeros:
            e, t = ESTADOS[n]
            l.append(f"| [{n}]({ARCHIVOS[n]}) | {t} | {e} |")
        l.append("")
    enlaza = ENLAZA[repo]
    if enlaza:
        l += ["## Los que enlaza, y no copia", "",
              "Viven en el repositorio de quien toma la decision. **Aqui solo esta el enlace**: una",
              "copia seria un segundo ADR el dia que alguien edite uno de los dos.", "",
              "| # | Decision | Vive en | Por que le importa a este repositorio |", "|---|---|---|---|"]
        for n, porque in sorted(enlaza.items()):
            e, t = ESTADOS[n]
            d = DUENO[n]
            rama = RAMA_SGTM if d == "sgtm" else RAMA
            l.append(f"| [{n}]({ORG}/{d}/{rama}/{REL}/{ARCHIVOS[n]}) | {t} | `{d}` | {porque} |")
        l.append("")
    l += [f"El reparto entero, con su criterio, esta en "
          f"[GOB-05 §4]({ORG}/sgtm/{RAMA_SGTM}/docs/00-gobierno/inventario-del-corte.md).",
          "", "Decisiones **pendientes**: "
          f"[GOB-02]({ORG}/sgtm/{RAMA_SGTM}/docs/00-gobierno/decisiones-abiertas.md).", "",
          PLANTILLA]
    destino = carpeta / "README.md"
    if destino.exists():
        MIAS = {"Los de este repositorio", "Los que enlaza, y no copia", "Plantilla",
                "La numeracion NO se reinicia"}
        # Sin los bloques de codigo: la PLANTILLA lleva dentro `## Contexto`, `## Decision`…
        # y leerlos como secciones del documento hacia que la guarda se negara SIEMPRE, que es
        # lo mismo que no tenerla.
        cuerpo = re.sub(r"^```.*?^```", "", destino.read_text(encoding="utf-8"),
                        flags=re.M | re.S)
        ajenas = [s.splitlines()[0].strip()
                  for s in re.split(r"^## ", cuerpo, flags=re.M)[1:]
                  if s.splitlines()[0].strip() not in MIAS]
        if ajenas:
            print(f"  {repo:16s} NO se toca: lleva {len(ajenas)} seccion(es) escritas a mano "
                  f"que este guion no genera y perderia -> {ajenas}")
            continue
    destino.write_text("\n".join(l), encoding="utf-8")
    print(f"  {repo:16s} indice con {len(numeros)} propio(s) y {len(enlaza)} enlazado(s)")
