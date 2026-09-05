#!/bin/bash
# Deriva el bloque del ADMINISTRADOR de la implantacion desde el archivo versionado
# de la municipalidad, para que la cuenta no pueda divergir entre Keycloak y la
# fila de `usuario` (ADR-0012, ADR-0005: `usuario.cuenta` == `preferred_username`).
#
#   ./identidad/datos-de-implantacion.sh 200101 >> .env
#
# Emite, en formato apto para `.env` y para `eval`:
#   KAMAYUK_ADMINISTRADOR=<cuenta del usuario con administrador:true>
#   KAMAYUK_NOMBRE_DEL_ADMINISTRADOR="<nombre apellido>"
#
# El resto de datos de la implantacion —ubigeo, nombre de la municipalidad, tipo,
# regimen de demostracion— siguen en el `.env`: este archivo solo declara personas.
set -euo pipefail

ubigeo="${1:?uso: datos-de-implantacion.sh <ubigeo>}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
archivo="$AQUI/municipalidades/$ubigeo.json"

[ -f "$archivo" ] || { echo "No existe $archivo" >&2; exit 1; }

python3 - "$archivo" <<'PY'
import json, sys

with open(sys.argv[1], encoding="utf-8") as fh:
    m = json.load(fh)

admins = [u for u in m.get("usuarios", []) if u.get("administrador") is True]
if len(admins) != 1:
    sys.exit(f"{sys.argv[1]}: tiene que haber exactamente un «administrador: true», hay {len(admins)}")
a = admins[0]
cuenta = a["cuenta"]
nombre = f"{a['nombre']} {a['apellido']}".strip()

print(f"KAMAYUK_ADMINISTRADOR={cuenta}")
print(f'KAMAYUK_NOMBRE_DEL_ADMINISTRADOR="{nombre}"')
PY
